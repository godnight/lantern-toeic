export type UnreviewedRssItem = Readonly<{
  guid: string | null;
  link: string | null;
  title: string | null;
  publishedAt: string | null;
  language: string | null;
  description: string | null;
  descriptionTruncated: boolean;
}>;
export declare function readRssItems(response: Response, options?: Readonly<{
  signal?: AbortSignal;
  maxBytes?: number;
  maxItems?: number;
  maxItemBytes?: number;
  yieldEvery?: number;
}>): Promise<UnreviewedRssItem[]>;
