import os
import sys

os.environ['ANTHROPIC_API_KEY'] = 'sk-cp-n1Oo8qb-mY4EV_hoPpTcK2boV3I4w4MUsswQM_UjaNsKeQNX1qe_M6eBC-Rl1afsAwnDqaH8TnbL_gKwyXtean2Ve9LoaUAWN3pFvAW3IxuTgAlAQsdFK6o'
os.environ['ANTHROPIC_BASE_URL'] = 'https://api.minimaxi.com/anthropic'

if __name__ == '__main__':
    import aide

    exp = aide.Experiment(
        data_dir='D:/projects/obsidian-llm-wiki',
        goal='Optimize compiler/chunker.py for speed. Focus on reducing regex compilation overhead and string operations. The evaluation measures execution time in milliseconds. Minimize the total time.',
        eval='Run "python benchmark_chunker.py" and extract the "ms per call" value. Minimize this value.'
    )
    exp.cfg.agent.code.model = 'MiniMax-M2.7'
    exp.cfg.agent.feedback.model = 'MiniMax-M2.7'
    exp.cfg.report.model = 'MiniMax-M2.7'

    print('Code model:', exp.cfg.agent.code.model)
    print('Starting AIDE ML optimization...')

    exp.run(steps=3)
