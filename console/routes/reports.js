import { latestReports, listReports, readReportFile } from "../services/reports-service.js";

export function handleReportsApi({ method, parts, searchParams }) {
  if (method !== "GET") return null;
  if (parts.length === 2) return { status: 200, body: { files: listReports() } };
  if (parts.length === 3 && parts[2] === "latest") return { status: 200, body: latestReports() };
  if (parts.length === 3 && parts[2] === "file") {
    const name = searchParams.get("name") || "";
    try {
      return { status: 200, body: readReportFile(name) };
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
  }
  return null;
}
