package linkpreview

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

type PreviewResponse struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
}

var (
	ogTitle       = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']`)
	ogTitleAlt    = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']`)
	ogDesc        = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']`)
	ogDescAlt     = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']`)
	ogImage       = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']`)
	ogImageAlt    = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']`)
	ogSiteName    = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']`)
	ogSiteNameAlt = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']`)
	titleTag      = regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
)

var client = &http.Client{
	Timeout: 5 * time.Second,
}

func extract(re, reAlt *regexp.Regexp, body string) string {
	if m := re.FindStringSubmatch(body); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	if m := reAlt.FindStringSubmatch(body); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func Handler(c *fiber.Ctx) error {
	raw := c.Query("url")
	if raw == "" {
		return fiber.NewError(fiber.StatusBadRequest, "url is required")
	}

	parsed, err := url.ParseRequestURI(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fiber.NewError(fiber.StatusBadRequest, "invalid url")
	}

	req, _ := http.NewRequest("GET", raw, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Discordbot/2.0)")
	req.Header.Set("Accept", "text/html")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode >= 400 {
		return c.JSON(fiber.Map{"data": PreviewResponse{URL: raw}})
	}
	defer resp.Body.Close()

	// Read first 64KB only — enough for <head> tags
	limited := io.LimitReader(resp.Body, 64*1024)
	body, err := io.ReadAll(limited)
	if err != nil {
		return c.JSON(fiber.Map{"data": PreviewResponse{URL: raw}})
	}
	html := string(body)

	preview := PreviewResponse{URL: raw}
	preview.Title = extract(ogTitle, ogTitleAlt, html)
	if preview.Title == "" {
		if m := titleTag.FindStringSubmatch(html); len(m) > 1 {
			preview.Title = strings.TrimSpace(m[1])
		}
	}
	preview.Description = extract(ogDesc, ogDescAlt, html)
	preview.Image = extract(ogImage, ogImageAlt, html)
	preview.SiteName = extract(ogSiteName, ogSiteNameAlt, html)

	return c.JSON(fiber.Map{"data": preview})
}

func RegisterRoutes(app *fiber.App, authMw fiber.Handler) {
	app.Get("/link-preview", authMw, Handler)
}
