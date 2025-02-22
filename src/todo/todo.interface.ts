export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
  notes?: string;
}
