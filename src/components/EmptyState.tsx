// Generic empty-state card used across multiple pages.
import { Card, CardContent } from "@/components/ui/card";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
        {description && <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm mb-4">{description}</p>}
        {action}
      </CardContent>
    </Card>
  );
}
