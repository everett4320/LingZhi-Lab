from setuptools import setup, find_namespace_packages

setup(
    name='cli-anything-lingzhilab',
    version='0.1.0',
    packages=find_namespace_packages(include=['cli_anything.*']),
    install_requires=['click>=8.0', 'requests>=2.28', 'websockets>=11.0'],
    entry_points={
        'console_scripts': [
            'lingzhilab=cli_anything.lingzhilab.lingzhilab_cli:cli',
            'lingzhi-lab=cli_anything.lingzhilab.lingzhilab_cli:cli',
            'vibelab=cli_anything.lingzhilab.lingzhilab_cli:vibelab_cli',
        ],
    },
    python_requires='>=3.8',
    author='Lingzhi Lab Agent Harness',
    description='CLI harness for the Lingzhi Lab AI research workspace',
)
