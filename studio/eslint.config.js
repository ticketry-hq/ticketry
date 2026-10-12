import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/state/*.ts", "src/state/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // The AST architecture gate also resolves normalized relative paths,
          // re-exports and dynamic imports; this gives editor feedback on imports.
          patterns: [{
            group: [
              "**/generated/**",
              "**/features/projects", "**/features/projects/**",
              "**/features/work-items", "**/features/work-items/**",
              "**/features/workflows", "**/features/workflows/**",
            ],
            message: "Client state may not import generated contracts or feature record views.",
          }],
        },
      ],
    },
  },
];
