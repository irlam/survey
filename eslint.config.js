export default [
  {
    files: ["app/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        alert: "readonly",
        confirm: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        CustomEvent: "readonly",
        URL: "readonly",
        Blob: "readonly",
        Image: "readonly",
        FileReader: "readonly",
        IntersectionObserver: "readonly",
        addSpinner: "readonly",
        removeSpinner: "readonly",
        showToast: "readonly",
        escapeHtml: "readonly",
        apiJson: "readonly",
        formatDate: "readonly",
        parseIssueDate: "readonly",
        setupLazyImages: "readonly",
        $: "readonly",
        viewerJumpToIssue: "readonly",
        viewerGoToPage: "readonly",
        viewerPreviewIssue: "readonly",
        showIssueModal: "readonly",
        startViewer: "readonly",
        renderPlansScreen: "readonly",
        openPlanInApp: "readonly",
        loadIssuesList: "readonly",
        updateSelectedUi: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "no-undef": "off",
      "no-implicit-globals": "off",
      "semi": ["warn", "always"],
      "quotes": ["warn", "single"],
      "no-var": "off",
      "prefer-const": "warn",
      "no-eval": "error",
      "no-implied-eval": "error"
    }
  },
  {
    ignores: ["vendor/", "node_modules/", "storage/", "e2e/", "tests/", "*.min.js"]
  }
];
