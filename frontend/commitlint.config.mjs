const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 200],
    "body-max-line-length": [2, "always", 500],
    "subject-case": [0],
  },
};

export default config;
