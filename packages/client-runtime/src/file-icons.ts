export type FileIconKind =
  | "agents"
  | "astro"
  | "babel"
  | "bash"
  | "biome"
  | "bootstrap"
  | "browserslist"
  | "bun"
  | "c"
  | "claude"
  | "cpp"
  | "css"
  | "database"
  | "default"
  | "docker"
  | "eslint"
  | "font"
  | "git"
  | "go"
  | "graphql"
  | "html"
  | "image"
  | "javascript"
  | "json"
  | "markdown"
  | "mcp"
  | "nextjs"
  | "npm"
  | "oxc"
  | "package"
  | "pnpm"
  | "postcss"
  | "prettier"
  | "python"
  | "react"
  | "readme"
  | "ruby"
  | "rust"
  | "sass"
  | "stylelint"
  | "svelte"
  | "svg"
  | "svgo"
  | "swift"
  | "table"
  | "tailwind"
  | "terraform"
  | "text"
  | "tsconfig"
  | "typescript"
  | "vite"
  | "vscode"
  | "vue"
  | "wasm"
  | "webpack"
  | "yml"
  | "zig"
  | "zip";

const FILE_ICON_BY_NAME = new Map(
  Object.entries({
    ".babelrc": "babel",
    ".babelrc.json": "babel",
    ".bash_profile": "bash",
    ".bashrc": "bash",
    ".browserslistrc": "browserslist",
    ".dockerignore": "docker",
    ".eslintignore": "eslint",
    ".eslintrc": "eslint",
    ".eslintrc.cjs": "eslint",
    ".eslintrc.js": "eslint",
    ".eslintrc.json": "eslint",
    ".eslintrc.yaml": "eslint",
    ".eslintrc.yml": "eslint",
    ".gitattributes": "git",
    ".gitignore": "git",
    ".gitkeep": "git",
    ".gitmodules": "git",
    ".oxlintrc.json": "oxc",
    ".postcssrc": "postcss",
    ".postcssrc.json": "postcss",
    ".postcssrc.yaml": "postcss",
    ".postcssrc.yml": "postcss",
    ".prettierignore": "prettier",
    ".prettierrc": "prettier",
    ".prettierrc.json": "prettier",
    ".prettierrc.cjs": "prettier",
    ".prettierrc.js": "prettier",
    ".prettierrc.mjs": "prettier",
    ".prettierrc.toml": "prettier",
    ".prettierrc.yaml": "prettier",
    ".prettierrc.yml": "prettier",
    ".stylelintignore": "stylelint",
    ".stylelintrc": "stylelint",
    ".stylelintrc.cjs": "stylelint",
    ".stylelintrc.js": "stylelint",
    ".stylelintrc.json": "stylelint",
    ".stylelintrc.mjs": "stylelint",
    ".stylelintrc.yaml": "stylelint",
    ".stylelintrc.yml": "stylelint",
    ".terraform.lock.hcl": "terraform",
    ".zprofile": "bash",
    ".zshenv": "bash",
    ".zshrc": "bash",
    "agents.md": "agents",
    "babel.config.js": "babel",
    "babel.config.cjs": "babel",
    "babel.config.json": "babel",
    "babel.config.mjs": "babel",
    "biome.json": "biome",
    "biome.jsonc": "biome",
    "bun.lock": "bun",
    "bun.lockb": "bun",
    "bunfig.toml": "bun",
    "claude.md": "claude",
    "compose.yaml": "docker",
    "compose.yml": "docker",
    "docker-compose.yaml": "docker",
    "docker-compose.yml": "docker",
    "docker-compose.override.yml": "docker",
    dockerfile: "docker",
    "eslint.config.js": "eslint",
    "eslint.config.cjs": "eslint",
    "eslint.config.mjs": "eslint",
    "eslint.config.mts": "eslint",
    "eslint.config.ts": "eslint",
    gemfile: "ruby",
    "next.config.js": "nextjs",
    "next.config.mjs": "nextjs",
    "next.config.mts": "nextjs",
    "next.config.ts": "nextjs",
    "package.json": "package",
    "pnpm-lock.yaml": "pnpm",
    "pnpm-workspace.yaml": "pnpm",
    "postcss.config.js": "postcss",
    "postcss.config.cjs": "postcss",
    "postcss.config.mjs": "postcss",
    "postcss.config.ts": "postcss",
    "prettier.config.js": "prettier",
    "prettier.config.cjs": "prettier",
    "prettier.config.mjs": "prettier",
    rakefile: "ruby",
    "readme.md": "readme",
    "stylelint.config.js": "stylelint",
    "stylelint.config.cjs": "stylelint",
    "stylelint.config.mjs": "stylelint",
    "svgo.config.js": "svgo",
    "svgo.config.cjs": "svgo",
    "svgo.config.mjs": "svgo",
    "svgo.config.ts": "svgo",
    "tailwind.config.js": "tailwind",
    "tailwind.config.cjs": "tailwind",
    "tailwind.config.mjs": "tailwind",
    "tailwind.config.ts": "tailwind",
    "tsconfig.json": "tsconfig",
    "vite.config.js": "vite",
    "vite.config.mjs": "vite",
    "vite.config.mts": "vite",
    "vite.config.ts": "vite",
    "webpack.config.js": "webpack",
    "webpack.config.babel.js": "webpack",
    "webpack.config.cjs": "webpack",
    "webpack.config.mjs": "webpack",
    "webpack.config.ts": "webpack",
  } as const),
);

const FILE_ICON_BY_EXTENSION = new Map(
  Object.entries({
    "7z": "zip",
    astro: "astro",
    avif: "image",
    "code-workspace": "vscode",
    bash: "bash",
    bmp: "image",
    bz2: "zip",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    css: "css",
    csv: "table",
    cts: "typescript",
    db: "database",
    env: "text",
    "env.development": "text",
    "env.local": "text",
    "env.production": "text",
    eot: "font",
    erb: "ruby",
    fish: "bash",
    gif: "image",
    go: "go",
    gql: "graphql",
    graphql: "graphql",
    gz: "zip",
    h: "c",
    hh: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    htm: "html",
    html: "html",
    ico: "image",
    icns: "image",
    ini: "text",
    inl: "cpp",
    jar: "zip",
    jpeg: "image",
    jpg: "image",
    js: "javascript",
    jsx: "react",
    json: "json",
    jsonc: "json",
    less: "css",
    md: "markdown",
    mdx: "markdown",
    "mdx.tsx": "markdown",
    mjs: "javascript",
    mts: "typescript",
    png: "image",
    postcss: "css",
    py: "python",
    pyi: "python",
    pyw: "python",
    pyx: "python",
    rake: "ruby",
    rar: "zip",
    rb: "ruby",
    rs: "rust",
    sass: "sass",
    scss: "sass",
    sh: "bash",
    sql: "database",
    sqlite: "database",
    sqlite3: "database",
    svelte: "svelte",
    svg: "svg",
    swift: "swift",
    tar: "zip",
    tf: "terraform",
    tfstate: "terraform",
    tfvars: "terraform",
    tgz: "zip",
    ts: "typescript",
    tsv: "table",
    tsx: "react",
    txt: "text",
    woff: "font",
    woff2: "font",
    vue: "vue",
    wasm: "wasm",
    webp: "image",
    yml: "yml",
    yaml: "yml",
    zig: "zig",
    zip: "zip",
    zsh: "bash",
  } as const),
);

export function resolveFileIconKind(value: string): FileIconKind {
  const normalized = value.replaceAll("\\", "/");

  const basename = normalized
    .slice(normalized.lastIndexOf("/") + 1)
    .replace(/:\d+(?::\d+)?$/, "")
    .toLowerCase();

  const exactIcon = FILE_ICON_BY_NAME.get(basename);

  if (exactIcon) return exactIcon;

  if (basename.startsWith("tsconfig.") && basename.endsWith(".json")) return "tsconfig";

  const segments = basename.split(".");

  for (let index = 1; index < segments.length; index += 1) {
    const icon = FILE_ICON_BY_EXTENSION.get(segments.slice(index).join("."));

    if (icon) return icon;
  }

  return "default";
}
