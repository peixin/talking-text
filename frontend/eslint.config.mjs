import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "components/ui/**"],
  },
  ...coreWebVitals,
  ...nextTypescript,
  prettier,
];

export default config;
