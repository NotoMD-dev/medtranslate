import { ReactNode } from "react";

export const Heading = ({ children }: { children: ReactNode }) => <h1 className="ds-h1">{children}</h1>;
export const Subheading = ({ children }: { children: ReactNode }) => <h2 className="ds-h2">{children}</h2>;
export const BodyText = ({ children }: { children: ReactNode }) => <p className="ds-body">{children}</p>;
export const MetaText = ({ children }: { children: ReactNode }) => <p className="ds-meta">{children}</p>;
export const MetricValue = ({ children }: { children: ReactNode }) => <p className="ds-metric">{children}</p>;
