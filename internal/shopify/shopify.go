package shopify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"sync"
	"time"
)

const query = `query($after: String, $filter: String!) {
  orders(first: 9, after: $after, query: $filter) {
    edges { node {
      name
      lineItems(first: 100) { edges { node { title variantTitle quantity } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`

type gqlResponse struct {
	Data struct {
		Orders struct {
			Edges []struct {
				Node struct {
					Name      string `json:"name"`
					LineItems struct {
						Edges []struct {
							Node struct {
								Title        string `json:"title"`
								VariantTitle string `json:"variantTitle"`
								Quantity     int    `json:"quantity"`
							} `json:"node"`
						} `json:"edges"`
					} `json:"lineItems"`
				} `json:"node"`
			} `json:"edges"`
			PageInfo struct {
				HasNextPage bool   `json:"hasNextPage"`
				EndCursor   string `json:"endCursor"`
			} `json:"pageInfo"`
		} `json:"orders"`
	} `json:"data"`
	Errors []struct {
		Message    string `json:"message"`
		Extensions *struct {
			Code string `json:"code"`
		} `json:"extensions,omitempty"`
	} `json:"errors"`
}

type Item struct {
	Title    string `json:"title"`
	Variant  string `json:"variant"`
	Quantity int    `json:"quantity"`
}

type Order struct {
	Number string `json:"number"`
	Items  []Item `json:"items"`
}

type Summary struct {
	Items      []Item  `json:"items"`
	Orders     []Order `json:"orders"`
	OrderCount int     `json:"orderCount"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
}

// TokenManager fetches and refreshes Shopify access tokens automatically.
type TokenManager struct {
	shop         string
	clientID     string
	clientSecret string

	mu           sync.Mutex
	accessToken  string
	refreshToken string
	expiresAt    time.Time
}

func NewTokenManager(shop, clientID, clientSecret string) *TokenManager {
	return &TokenManager{shop: shop, clientID: clientID, clientSecret: clientSecret}
}

// EnsureValid returns a valid access token, fetching one on first call and
// refreshing when within 5 min of expiry. Safe for concurrent use.
func (m *TokenManager) EnsureValid() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if time.Until(m.expiresAt) >= 5*time.Minute {
		return m.accessToken, nil
	}
	if m.refreshToken != "" {
		if err := m.refresh(); err == nil {
			return m.accessToken, nil
		}
	}
	if err := m.fetchNew(); err != nil {
		return "", err
	}
	return m.accessToken, nil
}

func (m *TokenManager) fetchNew() error {
	return m.postToken(url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {m.clientID},
		"client_secret": {m.clientSecret},
	})
}

func (m *TokenManager) refresh() error {
	return m.postToken(url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {m.clientID},
		"client_secret": {m.clientSecret},
		"refresh_token": {m.refreshToken},
	})
}

func (m *TokenManager) postToken(vals url.Values) error {
	resp, err := http.PostForm(fmt.Sprintf("https://%s/admin/oauth/access_token", m.shop), vals)
	if err != nil {
		return fmt.Errorf("shopify token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("shopify token: HTTP %d", resp.StatusCode)
	}

	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return fmt.Errorf("shopify token decode: %w", err)
	}
	if tr.AccessToken == "" {
		return fmt.Errorf("shopify token: empty access_token in response")
	}

	expiresIn := tr.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	m.accessToken = tr.AccessToken
	m.refreshToken = tr.RefreshToken
	m.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	return nil
}

type Client struct {
	http   *http.Client
	shop   string
	tokens *TokenManager
}

func NewClient(shop string, tokens *TokenManager) *Client {
	return &Client{
		http:   &http.Client{Timeout: 30 * time.Second},
		shop:   shop,
		tokens: tokens,
	}
}

func (c *Client) doQuery(ctx context.Context, cursor *string, filter string) (*gqlResponse, error) {
	token, err := c.tokens.EnsureValid()
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(map[string]any{
		"query":     query,
		"variables": map[string]any{"after": cursor, "filter": filter},
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("https://%s/admin/api/2025-04/graphql.json", c.shop),
		bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("shopify: HTTP %d", resp.StatusCode)
	}

	var out gqlResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return &out, nil
}

func (c *Client) fetchPage(ctx context.Context, cursor *string, filter string) (*gqlResponse, error) {
	resp, err := c.doQuery(ctx, cursor, filter)
	if err != nil {
		return nil, err
	}
	if len(resp.Errors) == 0 {
		return resp, nil
	}
	if resp.Errors[0].Extensions != nil && resp.Errors[0].Extensions.Code == "THROTTLED" {
		time.Sleep(time.Second)
		resp, err = c.doQuery(ctx, cursor, filter)
		if err != nil {
			return nil, err
		}
		if len(resp.Errors) == 0 {
			return resp, nil
		}
	}
	return nil, fmt.Errorf("shopify: %s", resp.Errors[0].Message)
}

// FetchSummary pages through unfulfilled orders created within the last `days`
// days (0 means no date filter) and returns aggregated product totals sorted
// by quantity descending.
func (c *Client) FetchSummary(ctx context.Context, days int) (*Summary, error) {
	filter := "fulfillment_status:unshipped financial_status:paid"
	if days > 0 {
		since := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
		filter += " created_at:>=" + since
	}

	type key struct{ title, variant string }
	totals := map[key]int{}
	orders := []Order{}
	var cursor *string

	for {
		resp, err := c.fetchPage(ctx, cursor, filter)
		if err != nil {
			return nil, err
		}

		for _, o := range resp.Data.Orders.Edges {
			ord := Order{Number: o.Node.Name}
			for _, li := range o.Node.LineItems.Edges {
				totals[key{li.Node.Title, li.Node.VariantTitle}] += li.Node.Quantity
				ord.Items = append(ord.Items, Item{
					Title:    li.Node.Title,
					Variant:  li.Node.VariantTitle,
					Quantity: li.Node.Quantity,
				})
			}
			orders = append(orders, ord)
		}

		if !resp.Data.Orders.PageInfo.HasNextPage {
			break
		}
		end := resp.Data.Orders.PageInfo.EndCursor
		cursor = &end
	}

	items := make([]Item, 0, len(totals))
	for k, qty := range totals {
		items = append(items, Item{Title: k.title, Variant: k.variant, Quantity: qty})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Title != items[j].Title {
			return items[i].Title < items[j].Title
		}
		return items[i].Variant < items[j].Variant
	})

	return &Summary{Items: items, Orders: orders, OrderCount: len(orders)}, nil
}
