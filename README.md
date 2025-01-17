# Thunder Compute VSCode Extension

This extension allows you to connect to Thunder Compute's GPU-powered Jupyter servers directly from VSCode.

## Features

- Connect to Thunder Compute Jupyter servers with GPU acceleration
- Seamless integration with VSCode's built-in Jupyter notebook experience
- Secure authentication using your Thunder Compute credentials

## Requirements

1. A Thunder Compute account
2. VSCode version 1.74.0 or higher
3. The VSCode Jupyter extension

## Setup

1. Install the extension from the VSCode marketplace
2. Log in to Thunder Compute using their CLI tool (this will create the auth token)
3. Open a Jupyter notebook in VSCode
4. Click the "Select Kernel" button and choose "Thunder Compute GPU Server" from the list

## Authentication

The extension looks for your Thunder Compute authentication token in `~/.thunder/token`. Make sure you've logged in using the Thunder Compute CLI tool before using this extension.

## Troubleshooting

If you encounter any issues:

1. Verify that you're logged in to Thunder Compute
2. Check that your authentication token exists in `~/.thunder/token`
3. Ensure you have an active Thunder Compute subscription
4. Check your internet connection

## Contributing

This extension is open source. Feel free to contribute by submitting issues or pull requests on GitHub.
