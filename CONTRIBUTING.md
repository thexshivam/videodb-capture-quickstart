# Contributing to VideoDB Capture Quickstart

Thank you for your interest in contributing to the VideoDB Recorder examples!

## How to Contribute

We welcome contributions in the form of:
*   **Bug fixes** to existing examples.
*   **New examples** showcasing different use cases (e.g., React, Vue, different patterns).
*   **Documentation improvements**.

### Running Examples Locally

1.  **Clone the repo**:
    ```bash
    git clone https://github.com/video-db/videodb-capture-quickstart.git
    cd videodb-capture-quickstart
    ```

2.  **Navigate to an example**:
    ```bash
    cd apps/electron-quickstart
    ```

3.  **Install dependencies**:
    ```bash
    npm install
    ```

4.  **Setup Environment**:
    Create a `.env` file in the app directory with your API keys:
    ```bash
    VIDEODB_API_KEY=your_api_key
    ```

5.  **Run the Electron App**:
    ```bash
    npm start
    ```

### Submitting a Pull Request

1.  Fork the repository.
2.  Create a branch for your feature (`git checkout -b feature/amazing-example`).
3.  Commit your changes.
4.  Push to the branch (`git push origin feature/amazing-example`).
5.  Open a Pull Request.

## Code Style

*   Use standard ESLint configurations provided in the repo.
*   Keep examples simple and focused on the relevant concepts.
*   Add comments explaining the "Why", not just the "How".
