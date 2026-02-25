import { ReactNode } from "react";

export function DataTable({ children }: { children: ReactNode }) {
  return <table className="ds-table">{children}</table>;
}

export const TableHeader = ({ children }: { children: ReactNode }) => <thead>{children}</thead>;
export const TableRow = ({ children }: { children: ReactNode }) => <tr>{children}</tr>;
