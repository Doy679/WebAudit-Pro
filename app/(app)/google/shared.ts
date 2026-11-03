import "server-only";
import { listProjects } from "@/server/projects";
import type { User } from "@/server/auth";

/** The website selected with ?project= (or the first one the user can see). */
export function selectProject(user: User, projectId?: string) {
  const projects = listProjects(user);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  return { projects, project };
}
