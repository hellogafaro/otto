# Page

One self-contained HTML file with no external requests: CSS and scripts inline, data and images as data URIs. Use plain JS for interaction; inline any small library you truly need. Render mermaid diagrams to inline SVG while you build the page (mermaid-cli), not in the browser. Title, a one-line status (proposal v2, evidence), then the content. It must work at 375px and 1280px wide.

Serve it from your computer, open it in a browser, check it with screenshots, then attach it to the chat. Save it with library_create only once a person approves it.

Start from this base and match the product's real look when the design calls for it. For interaction, `<details>` covers expand and collapse without a script; add a short inline script for tabs, toggles, filters and live states.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Title</title>
    <style>
      :root {
        --bg: #fff;
        --fg: #1d1c1a;
        --muted: #6b6966;
        --line: #e6e4e0;
        --ok: #15803d;
        --warn: #b45309;
        --bad: #dc2626;
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #151515;
          --fg: #ececec;
          --muted: #a3a3a3;
          --line: #2b2b2b;
        }
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font:
          14px/1.55 system-ui,
          sans-serif;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 20px;
      }
      h1 {
        font-size: 24px;
        margin: 0 0 4px;
      }
      h2 {
        font-size: 16px;
        margin: 32px 0 8px;
      }
      .muted,
      figcaption,
      th {
        color: var(--muted);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
      }
      img {
        max-width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      @media (max-width: 640px) {
        .pair {
          grid-template-columns: 1fr;
        }
      }
      .ok {
        color: var(--ok);
      }
      .warn {
        color: var(--warn);
      }
      .bad {
        color: var(--bad);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Checkout button fix</h1>
      <p class="muted">The button now submits on the first tap. Checked on staging.</p>
      <div class="pair">
        <figure>
          <img src="data:image/png;base64,..." alt="Before" />
          <figcaption>Before</figcaption>
        </figure>
        <figure>
          <img src="data:image/png;base64,..." alt="After" />
          <figcaption>After</figcaption>
        </figure>
      </div>
      <table>
        <tr>
          <th>Check</th>
          <th>Result</th>
        </tr>
        <tr>
          <td>Submit on first tap</td>
          <td class="ok">Passed</td>
        </tr>
        <tr>
          <td>Older phones</td>
          <td class="warn">Unverified</td>
        </tr>
      </table>
    </main>
  </body>
</html>
```
