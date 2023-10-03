import * as React from "react";
import Link from "next/link";
import styles from "./index.module.scss";

const Logo = ({ name, link }) => (
  <>
    {link ? (
      <a
        href={link}
        target="_blank"
        className={`buttonAccent ${styles.buttonAccent}`}
      >
        <button type={"button"}>{name}</button>
      </a>
    ) : (
      <div className={`buttonAccent ${styles.buttonAccent}`}>
        <button type={"button"}>{name}</button>
      </div>
    )}
  </>
);

export default Logo;
