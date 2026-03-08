export default {
  // Type-check: use function syntax to discard the file list appended by lint-staged.
  // This runs whole-project type checking (correct, since a change in one file can break another)
  // but only triggers when relevant files are staged.
  "server/src/**/*.ts": () => "tsc --noEmit -p server/tsconfig.json",
  "client/src/**/*.{ts,tsx}": () => "tsc --noEmit -p client/tsconfig.lint.json",
  "shared/**/*.ts": () => "tsc --noEmit -p shared/tsconfig.json",

  // Lint: pass filenames so eslint only processes staged files
  "{server,client,shared}/**/*.{ts,tsx}": (filenames) =>
    `eslint --fix ${filenames.join(" ")}`,
};
