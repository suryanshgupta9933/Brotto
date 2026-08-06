"""Setup script for brotto-sdk."""
from setuptools import setup, find_packages

if __name__ == "__main__":
    setup(
        name="brotto-sdk",
        version="1.0.0",
        description="Official Python SDK for the Brotto Browser Automation Platform",
        author="Brotto Team",
        author_email="sdk@fara.example.com",
        url="https://github.com/fara/fara15",
        packages=find_packages(include=["brotto_sdk", "brotto_sdk.*"]),
        python_requires=">=3.11",
        install_requires=[
            "httpx>=0.25.0",
            "pydantic>=2.0.0",
            "python-jose[cryptography]>=3.3.0",
        ],
        extras_require={
            "dev": [
                "pytest>=7.4.0",
                "pytest-asyncio>=0.21.0",
                "pytest-httpserver>=1.0.0",
            ],
        },
        classifiers=[
            "Development Status :: 4 - Beta",
            "Intended Audience :: Developers",
            "License :: OSI Approved :: MIT License",
            "Programming Language :: Python :: 3",
            "Programming Language :: Python :: 3.11",
            "Programming Language :: Python :: 3.12",
        ],
    )
