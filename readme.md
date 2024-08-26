# evalite

Poor man's LLM eval platform. Still under active development.

![evalite](./screenshot.png)

We allow comparing against
- multiple LLM providers (eg OpenAI vs Anthropic)
- same models on different providers (eg Llama on Fireworks vs on Together)
- sampling strategies (i.e. varied temperature)
- different versions of the prompt

We support rating results with simple thumbs up / down. 

## Features

- MIT license
- Autogenerate prompts from task description
- Templated variable replacement
- Autogenerate test cases from prompt (generated values for variables)
- Run test cases against multiple LLM versions / sampling strategies
- XML output formatting
- Ordinal ranking (thumbs up / down, unpaired)

Future:

- Streaming output 
- Latency statistics
- Multimodal input
- Human rate test cases (pairwise)
- Auto LLM grade test cases

## Architecture

We use a Vite + React frontend and a Go backend. Communication is handled via Connect / Protobufs.

## Usage

We use [hermit](https://cashapp.github.io/hermit/) to manage dependencies.

Run the dev servers:

```bash
go run cmd/serverd/main.go 
cd frontend && bun install && bun run dev
```

The go server must be able to load env vars corresponding to your LLM provider API keys (eg `$OPENAI_API_KEY`). This can be via a .env file or via the environment. If the keys are found, the server will automatically load support for the LLM provider and make it available to the frontend.

To regenerate protobufs after a change, unfortunately you need a _second_ `bun install`. This is an artifact of needing `protoc-gen-[typescript]` in the CLI path, and that requires a `bun install` to be available.

```bash
# optionally I think these are available in hermit too, but not the typescript generators
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest

bun install
bun x buf generate
```

Production is an exercise left to the reader.