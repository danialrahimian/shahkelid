import { useParams } from "react-router";

import { PostEditorPage } from "@/features/staff/components/posts-page";

/** /staff/posts/:postId ("new" for a new post) */
const PostRoute = () => {
  const { postId = "new" } = useParams();
  return <PostEditorPage key={postId} postId={postId} />;
};

export default PostRoute;
