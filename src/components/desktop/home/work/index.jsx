import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Button from "../../../button";

const Work = ({ scroll }) => (
  <div className={styles.work}>
    <Title content={"Collaborate"} />
    <div className={styles.description}>
      <p>
      <br />
      We believe collaboration and diversity are critical for building the bold new internet & encourage
      those who share our vision to reach out for partnerships and projects 
      </p>
    </div>
      <br />
    <div onClick={() => (scroll.scrollTop = 0.92 * scroll.scrollHeight)}>
      <Button name={"Get in touch"} link={"https://t.me/+EBSNTw1oFipjZTQ1"}/>
    </div>
  </div>
);

export default Work;
