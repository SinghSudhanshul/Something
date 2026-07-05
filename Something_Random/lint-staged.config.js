module.exports = {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{js,jsx}': ['prettier --write'],
  '*.{json,md}': ['prettier --write'],
};
