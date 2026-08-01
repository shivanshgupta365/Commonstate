module.exports = {
  ci: {
    collect: {
      startServerCommand:
        "npm run start -- --hostname 127.0.0.1 --port 3000",
      startServerReadyPattern: "127.0.0.1:3000|localhost:3000|Ready",
      url: [
        "http://127.0.0.1:3000/",
        "http://127.0.0.1:3000/login",
        "http://127.0.0.1:3000/demo/ai-operations",
        "http://127.0.0.1:3000/demo/agency-operations",
      ],
      numberOfRuns: 2,
      settings: {
        chromeFlags: "--no-sandbox --headless",
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
