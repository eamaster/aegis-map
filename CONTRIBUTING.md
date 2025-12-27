# Contributing to AegisMap

First off, thank you for considering contributing to AegisMap! It's people like you that make AegisMap such a great tool for disaster response teams.

## Code of Conduct

This project and everyone participating in it is governed by our commitment to creating a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- **Clear descriptive title**
- **Exact steps to reproduce**
- **Expected behavior**
- **Actual behavior**
- **Screenshots** (if applicable)
- **Environment details** (OS, browser, versions)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear descriptive title**
- **Detailed description** of the proposed functionality
- **Rationale** - why would this be useful?
- **Mockups/examples** (if applicable)

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure the test suite passes
4. Make sure your code follows the existing style
5. Write a clear commit message
6. Update documentation as needed

## Development Process

### Setting Up Development Environment

See the main [README.md](README.md) for setup instructions.

### Code Style

- **TypeScript**: Use strict type checking
- **React**: Functional components with hooks
- **Formatting**: Prettier with project config
- **Linting**: ESLint with project rules

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
feat: add support for typhoon tracking
fix: resolve map re-rendering issue
docs: update API documentation
chore: update dependencies
```

### Testing

Before submitting a PR:

- [ ] Test locally on desktop and mobile
- [ ] Verify all existing features still work
- [ ] Check browser console for errors
- [ ] Test with and without API keys configured

## Project Structure

```
aegis-map/
├── backend/          # Cloudflare Worker API
│   ├── src/
│   │   └── index.ts  # Main API routes
│   └── wrangler.jsonc
├── frontend/         # React Application
│   ├── src/
│   │   ├── components/
│   │   ├── utils/
│   │   └── types/
│   └── vite.config.ts
└── README.md
```

## Areas for Contribution

### High Priority
- [ ] Unit tests for orbital calculations
- [ ] Integration tests for API endpoints
- [ ] Accessibility improvements
- [ ] Performance optimizations
- [ ] Mobile UX enhancements

### Feature Requests
- [ ] Historical disaster timeline
- [ ] Export pass schedule feature
- [ ] Push notifications
- [ ] SAR satellite support
- [ ] User authentication

### Documentation
- [ ] Video tutorials
- [ ] API client examples (Python, JavaScript)
- [ ] Deployment guides for other platforms
- [ ] Troubleshooting guides

## Questions?

Feel free to open an issue with the `question` label or start a discussion in GitHub Discussions.

Thank you for your contributions! 🎉
