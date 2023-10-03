import React, { Fragment } from "react"
import { Canvas } from "@react-three/fiber";
import Media from 'react-media';
import Preloader from "../src/components/preloader";
import Desktop from "../src/components/desktop";
import Mobile from "../src/components/mobile";
import { NextSeo } from 'next-seo';

export default function Home() {
  return (
    <>
      <NextSeo
        title="Daoism Systems"
        description="A tech studio building DAOs and DeFi protocols."
      />
      <Fragment>
        <Preloader />
        <Canvas
          gl={{
            powerPreference: "low-power",
            alpha: false,
            antialias: true,
            stencil: true,
            depth: true,
          }}
          shadows={false}
          camera={{ position: [0, 0, 0] }}
          dpr={[1, 1.5]}
          className={'canvas'}
        >

          <Media queries={{ small: { maxWidth: 992 } }}>
            {matches =>
              matches.small ? (
                <Mobile />
              ) : (
                <Desktop />
              )
            }
          </Media>
        </Canvas>
      </Fragment>

    </>
  )
};
