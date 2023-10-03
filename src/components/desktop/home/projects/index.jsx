import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Link from "next/link";
import Button from "../../../button";
import Slider from "./slider";

const Projects = ({ scroll }) => (
  <div className={styles.projects}>
    <Title content={"Ventures"} />
    <div className={styles.subtitle}>Nurturing breakthrough ideas</div>
    <div className={styles.description}>
      We bring technical and operational expertise to realize
      the cutting edge of DAO and DeFi innovation across web3.
    </div>
    {/* <Button name={"Apply with your idea"} link={"#"} /> */}
    <div className={styles.slider}>
      <Slider scroll={scroll} />
    </div>
  </div>
);

export default Projects;
