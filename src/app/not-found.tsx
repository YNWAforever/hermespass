import { ErrorPanel } from "@/components/errors/error-panel";

export default function NotFound() {
  return (
    <ErrorPanel
      statusCode={404}
      title="Page not found"
      message="The page you're looking for doesn't exist or has been moved."
    />
  );
}
