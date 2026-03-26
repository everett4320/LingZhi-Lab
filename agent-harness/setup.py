from setuptools import setup, find_namespace_packages

setup(
    name='cli-anything-drclaw',
    version='0.1.0',
    packages=find_namespace_packages(include=['cli_anything.*']),
    install_requires=['click>=8.0', 'requests>=2.28', 'websockets>=11.0'],
    entry_points={
        'console_scripts': [
            'drclaw=cli_anything.drclaw.drclaw_cli:cli',
            'dr-claw=cli_anything.drclaw.drclaw_cli:cli',
            'vibelab=cli_anything.drclaw.drclaw_cli:vibelab_cli',
        ],
    },
    python_requires='>=3.8',
    author='Dr. Claw Agent Harness',
    description='CLI harness for the Dr. Claw AI research workspace',
)
