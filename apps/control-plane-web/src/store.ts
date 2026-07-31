import { create } from 'zustand';
import type { Session } from './types';

interface AppState {
  // Current user/session
  currentSession: Session | null;
  setCurrentSession: (session: Session | null) => void;

  // Selected items
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  // Active approvals count for badge
  pendingApprovalsCount: number;
  setPendingApprovalsCount: (count: number) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export const useStore = create<AppState>((set) => ({
  currentSession: null,
  setCurrentSession: (session) => set({ currentSession: session }),

  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  selectedSessionId: null,
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),

  pendingApprovalsCount: 0,
  setPendingApprovalsCount: (count) => set({ pendingApprovalsCount: count }),

  notifications: [],
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: crypto.randomUUID(), timestamp: Date.now() },
      ],
    })),
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
