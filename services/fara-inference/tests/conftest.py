"""
Pytest configuration and fixtures for Fara inference tests.
"""

import pytest


@pytest.fixture
def sample_goal():
    """Sample task goal for testing."""
    return "Navigate to example.com and search for cats"


@pytest.fixture
def sample_screenshot_description():
    """Sample screenshot description for testing."""
    return "A search engine homepage with a search box and Google logo visible"


@pytest.fixture
def sample_recent_actions():
    """Sample recent actions for testing."""
    return [
        {
            "action_type": "visit_url",
            "description": "Navigate to Google",
            "success": True,
            "result": "Page loaded successfully",
        },
        {
            "action_type": "click",
            "description": "Click search box",
            "success": True,
            "result": "Search box focused",
        },
    ]


@pytest.fixture
def sample_approved_answers():
    """Sample approved user answers for testing."""
    return [
        "Yes, proceed with the search",
        "Confirm navigation to results page",
    ]


@pytest.fixture
def sample_success_result():
    """Sample successful action result."""
    return {
        "success": True,
        "result": "Action completed successfully",
    }


@pytest.fixture
def sample_failure_result():
    """Sample failed action result."""
    return {
        "success": False,
        "error": "Element not found at expected coordinates",
    }
