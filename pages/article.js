import * as React from "react";
import styles from '../src/components/pages/blog/index.module.scss';
import Article from '../src/components/pages/blog/article';
import Logo from '../src/components/logo';
import Menu from '../src/components/desktop/home/menu';

const iconBack = (
  <svg width="11" height="18" viewBox="0 0 11 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M0.585938 8.99992L9.29304 0.292816L10.7073 1.70703L3.41436 8.99992L10.7073 16.2928L9.29304 17.707L0.585938 8.99992Z" fill="white" />
  </svg>
);

export default function pageArticle() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Logo position={'relative'} />
      </div>
      <div className={styles.return}>
        <button type={'button'} onClick={() => window.history.back()}>
          {iconBack} <span>Return to blog</span>
        </button>
      </div>
      <Article coverUrl={'/blog.jpg'} date={'25/10/2022'} title={'15 Ways to change your perception of colour theory in web design.'} category={'Innovation'} />
      <Menu fixed />
    </div>
  )
}
