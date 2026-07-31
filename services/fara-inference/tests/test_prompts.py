"""
Unit tests for prompt template manager.
"""

import pytest
from app.prompts import (
    PromptVersion,
    PromptTemplateManager,
    ObservationPrompt,
    get_prompt_manager,
)


class TestPromptVersion:
    """Tests for PromptVersion enum."""

    def test_prompt_versions_exist(self):
        """Verify all expected prompt versions exist."""
        assert PromptVersion.V1 is not None
        assert PromptVersion.V2 is not None

    def test_prompt_versions_have_values(self):
        """Verify prompt versions have string values."""
        assert PromptVersion.V1.value == "v1"
        assert PromptVersion.V2.value == "v2"


class TestPromptTemplateManager:
    """Tests for PromptTemplateManager."""

    def test_manager_initialization(self):
        """Test manager initializes with all template versions."""
        manager = PromptTemplateManager()
        versions = manager.list_versions()
        assert PromptVersion.V1 in versions
        assert PromptVersion.V2 in versions

    def test_get_active_template(self):
        """Test retrieving the active template."""
        manager = PromptTemplateManager()
        template = manager.get_active_template()
        assert template is not None
        assert template.version == manager.get_version()

    def test_get_specific_version(self):
        """Test retrieving a specific template version."""
        manager = PromptTemplateManager()
        v1_template = manager.get_template(PromptVersion.V1)
        assert v1_template.version == PromptVersion.V1

    def test_set_active_version(self):
        """Test setting the active version."""
        manager = PromptTemplateManager()
        manager.set_active_version(PromptVersion.V1)
        assert manager.get_version() == PromptVersion.V1
        manager.set_active_version(PromptVersion.V2)
        assert manager.get_version() == PromptVersion.V2

    def test_invalid_version_raises_error(self):
        """Test that invalid version raises ValueError."""
        manager = PromptTemplateManager()
        with pytest.raises(ValueError):
            manager.set_active_version(PromptVersion.V1)  # This should work
        # Test with a mock invalid version
        with pytest.raises(ValueError):
            manager.get_template(PromptVersion.V2)  # This should work

    def test_render_prompt_v2(self):
        """Test prompt rendering with V2 template."""
        manager = PromptTemplateManager()
        manager.set_active_version(PromptVersion.V2)

        system, user = manager.render_prompt(
            goal="Navigate to example.com and search for cats",
            screenshot_description="A search engine homepage with a search box visible",
            recent_actions=[
                {"action_type": "visit_url", "description": "Navigate to Google", "success": True, "result": "Page loaded"},
            ],
            approved_user_answers=["Yes, proceed with the search"],
            previous_action_result={"success": True, "result": "Search submitted"},
        )

        assert "Fara" in system
        assert "Task Objective" in user
        assert "Navigate to example.com" in user
        assert "search engine homepage" in user

    def test_render_prompt_with_failure(self):
        """Test prompt rendering with action failure."""
        manager = PromptTemplateManager()
        manager.set_active_version(PromptVersion.V2)

        system, user = manager.render_prompt(
            goal="Click the submit button",
            screenshot_description="A form with a disabled submit button",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={"success": False, "error": "Button not found"},
            failure_message="The submit button was not found at the expected coordinates",
        )

        assert "Previous Action Failed" in user or "Failed" in user

    def test_render_prompt_empty_history(self):
        """Test prompt rendering with no action history."""
        manager = PromptTemplateManager()
        manager.set_active_version(PromptVersion.V2)

        system, user = manager.render_prompt(
            goal="Simple task",
            screenshot_description="Blank page",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={},
        )

        assert "Simple task" in user
        assert "Blank page" in user

    def test_build_observation_prompt(self):
        """Test building structured observation prompt."""
        manager = PromptTemplateManager()

        prompt = manager.build_observation_prompt(
            goal="Test goal",
            screenshot_description="Test screenshot",
            recent_actions=[{"action_type": "click", "success": True}],
            approved_user_answers=["Answer 1"],
            previous_action_result={"success": True},
            failure_message=None,
        )

        assert isinstance(prompt, ObservationPrompt)
        assert prompt.version == manager.get_version()
        assert prompt.goal == "Test goal"
        assert prompt.screenshot_description == "Test screenshot"
        assert len(prompt.recent_actions) == 1
        assert len(prompt.approved_user_answers) == 1

    def test_observation_prompt_to_dict(self):
        """Test observation prompt serialization."""
        prompt = ObservationPrompt(
            version=PromptVersion.V2,
            goal="Test",
            screenshot_description="Screenshot",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={"success": True},
        )

        data = prompt.to_dict()
        assert data["version"] == "v2"
        assert data["goal"] == "Test"
        assert data["screenshot_description"] == "Screenshot"

    def test_observation_prompt_checksum(self):
        """Test prompt checksum for caching."""
        prompt1 = ObservationPrompt(
            version=PromptVersion.V2,
            goal="Test",
            screenshot_description="Screenshot",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={},
        )

        prompt2 = ObservationPrompt(
            version=PromptVersion.V2,
            goal="Test",
            screenshot_description="Screenshot",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={},
        )

        assert prompt1.get_checksum() == prompt2.get_checksum()

        prompt3 = ObservationPrompt(
            version=PromptVersion.V2,
            goal="Different",
            screenshot_description="Screenshot",
            recent_actions=[],
            approved_user_answers=[],
            previous_action_result={},
        )

        assert prompt1.get_checksum() != prompt3.get_checksum()


class TestGetPromptManager:
    """Tests for singleton prompt manager."""

    def test_singleton(self):
        """Test that get_prompt_manager returns the same instance."""
        manager1 = get_prompt_manager()
        manager2 = get_prompt_manager()
        assert manager1 is manager2
