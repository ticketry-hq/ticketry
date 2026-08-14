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
          paths: [
            {
              name: "../shared/api/types",
              message: "The client store may not hold record types. See LLD 2.",
            },
            {
              name: "@/shared/api/types",
              message: "The client store may not hold record types. See LLD 2.",
            },
          ],
        },
      ],
    },
  },
];
