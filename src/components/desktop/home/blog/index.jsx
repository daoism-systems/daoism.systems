import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Link from "next/link";
import Button from "../../../button";
import Slider from "./slider";

const Blog = ({}) => (
  <div className={styles.blog}>
    <Title content={"Blog"} />
    <Slider />
  </div>
);

export default Blog;
