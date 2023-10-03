import Image from "next/image";
import * as React from "react";
import styles from "./index.module.scss";

const Article = ({ title, date, coverUrl, category }) => (
  <section className={styles.article}>
    <header>
      <div className={styles.cover}>
        <Image alt={title} src={coverUrl} layout="fill" objectFit="cover" />
      </div>
      <div className={styles.info}>
        <div className={styles.category}>{category}</div>
        <div className={styles.date}>{date}</div>
      </div>
      <h1>{title}</h1>
    </header>
    <div className={styles.content}>
      <h3>Colour vision is mind-boggling</h3>
      <p>
        Colour theory is an essential skill for a web designer + a strong
        knowledge of these systems is imperative to create beautiful designs. We
        must consider how to use colours not just visually but psychologically
        too. In this article, I take an in-depth study of structured +
        methodical processes that approach a constantly evolving existence of
        colour. Colour comes in varying degrees of brilliance, it can be
        vibrant, calming, complementary + harmonious. They offer us a passage
        through time as they present a constant reminder contentment can be
        found in the simplest of things.
      </p>
      <p>
        Colour theory is an essential skill for a web designer + a strong
        knowledge of these systems is imperative to create beautiful designs. We
        must consider how to use colours not just visually but psychologically
        too. In this article, I take an in-depth study of structured +
        methodical processes that approach a constantly evolving existence of
        colour. Colour comes in varying degrees of brilliance, it can be
        vibrant, calming, complementary + harmonious. They offer us a passage
        through time as they present a constant reminder contentment can be
        found in the simplest of things.
      </p>
    </div>
  </section>
);

export default Article;
