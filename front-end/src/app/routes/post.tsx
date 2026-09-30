import { useParams } from "react-router";

import { PostPage } from "@/features/journal/components/post-page";

/** /posts/:slug: one post. */
const PostRoute = () => {
  const { slug = "" } = useParams();
  return <PostPage key={slug} slug={slug} />;
};

export default PostRoute;
