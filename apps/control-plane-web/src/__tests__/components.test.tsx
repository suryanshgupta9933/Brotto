import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, Button, Card, Spinner } from '../components/Layout';

describe('UI Components', () => {
  describe('Badge', () => {
    it('renders with default variant', () => {
      render(<Badge>Default</Badge>);
      expect(screen.getByText('Default')).toBeTruthy();
    });

    it('renders with success variant', () => {
      render(<Badge variant="success">Success</Badge>);
      expect(screen.getByText('Success')).toBeTruthy();
    });

    it('renders with danger variant', () => {
      render(<Badge variant="danger">Danger</Badge>);
      expect(screen.getByText('Danger')).toBeTruthy();
    });
  });

  describe('Button', () => {
    it('renders with children', () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByText('Click Me')).toBeTruthy();
    });

    it('handles click events', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      screen.getByText('Click Me').click();
      expect(handleClick).toHaveBeenCalled();
    });

    it('is disabled when disabled prop is true', () => {
      const handleClick = vi.fn();
      render(<Button disabled onClick={handleClick}>Click Me</Button>);
      screen.getByText('Click Me').click();
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('Card', () => {
    it('renders children', () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText('Card Content')).toBeTruthy();
    });

    it('handles click events when onClick provided', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Clickable Card</Card>);
      screen.getByText('Clickable Card').click();
      expect(handleClick).toHaveBeenCalled();
    });
  });

  describe('Spinner', () => {
    it('renders with default size', () => {
      render(<Spinner />);
      expect(document.querySelector('.animate-spin')).toBeTruthy();
    });

    it('renders with lg size', () => {
      render(<Spinner size="lg" />);
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });
  });
});
