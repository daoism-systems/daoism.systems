import React, { useEffect, useState, useRef } from "react";
import * as ReactDOM from "react-dom";
import styles from "./index.module.scss";

const Title = ({ content }) => {
  const refTitle = useRef();

  useEffect(() => {
    let title = refTitle.current;
    const words = title.textContent.replace(
      /(\S*%\S*)|(\S+)/g,
      "<span class='word'>$&</span>"
    );
    title.innerHTML = words;

    // Select all inner span box from title
    const wordsE = title.querySelectorAll(".word");
    wordsE.forEach((event) => {
      event.innerHTML = event.textContent.replace(
        /\S/g,
        "<span class='letter'>$&</span>"
      );
    });
  }, [refTitle.current]);

  return (
    <h2 ref={refTitle} className={styles.title}>
      {content}
    </h2>
  );
};

export default Title;
