import type {
  StudioCaseNode,
  StudioOutlineNode,
  StudioProjectItem,
  StudioProjectSummary,
  StudioSuiteNode,
} from "./shared";

export type TreeNodePayload = StudioProjectItem | StudioSuiteNode | StudioCaseNode;

export interface TreeNodeInfo extends StudioOutlineNode {
  payload: TreeNodePayload;
}

export type ProjectSummary = StudioProjectSummary;
