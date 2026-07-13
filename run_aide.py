import os
from pathlib import Path

DEFAULT_ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'


def require_runtime_credentials() -> None:
    """Fail closed unless the API credential is supplied out of band."""
    if not os.environ.get('ANTHROPIC_API_KEY'):
        raise RuntimeError(
            'ANTHROPIC_API_KEY is required; configure it through the environment '
            'or an LLM Wiki Secret Reference before running AIDE.'
        )
    os.environ.setdefault('ANTHROPIC_BASE_URL', DEFAULT_ANTHROPIC_BASE_URL)


if __name__ == '__main__':
    import aide

    require_runtime_credentials()
    exp = aide.Experiment(
        data_dir=str(Path(__file__).resolve().parent),
        goal='''Push obsidian-llm-wiki to SOTA. Focus on:
1. MCP server: JSON serialization (use fast-json-stringify or simdjson), caching
2. Python compiler: Concurrent async processing, batch LLM calls
3. Query: RRF algorithm micro-optimizations

IMPORTANT: After changes, run "cd mcp-server && npm test" and "python -m pytest compiler/tests/" to verify tests pass.
All changes must be backward compatible - no breaking API changes.''',
        eval='''Run tests: "cd mcp-server && npm test && cd .. && python -m pytest compiler/tests/" - all must pass.'''
    )
    exp.cfg.agent.code.model = 'MiniMax-M2.7'
    exp.cfg.agent.feedback.model = 'MiniMax-M2.7'
    exp.cfg.report.model = 'MiniMax-M2.7'

    print('Code model:', exp.cfg.agent.code.model)
    print('Starting SOTA optimization...')

    exp.run(steps=3)
