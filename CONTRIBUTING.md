# Contributing

Thanks for your interest in contributing.

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused and include clear commit messages.
3. Open a pull request against `main` with a concise description.

## Pull Request Checklist

- Confirm `npm ci` completes successfully.
- Confirm syntax checks pass:
  - `node --check server.js`
  - `node --check public/app.js`
- Add or update documentation for behavior changes.

## Development Notes

- This project is mobile-first; preserve touch interactions and responsive behavior.
- Keep server/client API payloads in sync when changing contracts.

## Code Of Conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
