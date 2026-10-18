export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
  time?: string;
  notes?: string;
}
