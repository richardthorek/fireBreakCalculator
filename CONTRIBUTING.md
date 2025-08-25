# Contributing to RFS Fire Break Calculator

We love your input! We want to make contributing to the RFS Fire Break Calculator as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with GitHub

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## We Use [GitHub Flow](https://guides.github.com/introduction/flow/index.html)

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Any contributions you make will be under the MIT Software License

In short, when you submit code changes, your submissions are understood to be under the same [MIT License](http://choosealicense.com/licenses/mit/) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using GitHub's [issue tracker](../../issues)

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](../../issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

People *love* thorough bug reports. I'm not even kidding.

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm 9+
- Azure Functions Core Tools (for API development)
- A Mapbox access token

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/richardthorek/rfsFireBreakCalculator.git
   cd rfsFireBreakCalculator
   ```

2. **Install dependencies:**
   ```bash
   # Frontend
   cd webapp
   npm install
   
   # Backend (optional for frontend-only development)
   cd ../api
   npm install
   ```

3. **Configure environment:**
   ```bash
   cd webapp
   cp .env.example .env
   # Edit .env with your Mapbox token
   ```

4. **Start development servers:**
   ```bash
   # Frontend only
   cd webapp
   npm run dev
   
   # Full stack (requires Azure Functions CLI)
   # Terminal 1: API
   cd api
   npm start
   
   # Terminal 2: Frontend
   cd webapp
   npm run dev
   ```

### Code Style

- Use TypeScript for all new code
- Follow the existing code style (ESLint will help)
- Write meaningful commit messages
- Add JSDoc comments for public APIs
- Ensure accessibility compliance (WCAG 2.1 AA)

### Testing

- Write unit tests for new utilities and components
- Test keyboard navigation for UI changes
- Verify mobile responsiveness
- Check color contrast for accessibility

### Documentation

- Update relevant documentation files
- Add JSDoc comments to functions
- Update the README if needed
- Include examples for new features

## Use a Consistent Coding Style

- 2 spaces for indentation rather than tabs
- You can try running `npm run lint` for style unification

## License

By contributing, you agree that your contributions will be licensed under its MIT License.

## References

This document was adapted from the open-source contribution guidelines for [Facebook's Draft](https://github.com/facebook/draft-js/blob/a9316a723f9e918afde44dea68b5f9f39b7d9b00/CONTRIBUTING.md).