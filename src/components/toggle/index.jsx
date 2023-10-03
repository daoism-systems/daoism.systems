import React, { useEffect, useRef } from "react";
import styles from "./index.module.scss";

const Toggle = (props) => {
  const { handleToggle, active, title, description, id } = props;
  return (
    <div
      className={`${styles.toggleBox} ${active === id ? styles.active : null}`}
    >
      <h3
        onClick={() => handleToggle(id)}
        className={`${active === id ? styles.active : null}`}
      >
        {title}
      </h3>
      <div className={styles.description}>{description}</div>
    </div>
  );
};

export default Toggle;
