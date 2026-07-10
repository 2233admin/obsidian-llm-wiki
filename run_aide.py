import os
import sys

os.environ['ANTHROPIC_API_KEY'] = 'sk-cp-n1Oo8qb-mY4EV_hoPpTcK2boV3I4w4MUsswQM_UjaNsKeQNX1qe_M6eBC-Rl1afsAwnDqaH8TnbL_gKwyXtean2Ve9LoaUAWN3pFvAW3IxuTgAlAQsdFK6o'
os.environ['ANTHROPIC_BASE_URL'] = 'https://api.minimaxi.com/anthropic'

if __name__ == '__main__':
    import aide

    exp = aide.Experiment(
        data_dir='D:/projects/obsidian-llm-wiki',
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
