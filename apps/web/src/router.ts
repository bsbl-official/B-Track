import { useEffect, useState } from "react";

// Minimal hash router: "#/tasks?open=abc" -> { page: "tasks", params: open=abc }.
export type Route = { page: string; params: URLSearchParams };

function readRoute(): Route {
  const [path = "", query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { page: path || "dashboard", params: new URLSearchParams(query) };
}

export function navigate(page: string, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params)}` : "";
  window.location.hash = `#/${page}${query}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
