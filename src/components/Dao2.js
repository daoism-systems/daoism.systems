import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  useGLTF,
  PerspectiveCamera,
  useAnimations,
  PointMaterial,
  useProgress
} from '@react-three/drei';
import { useFrame, useLoader } from '@react-three/fiber';
import { LayerMaterial, Depth, Fresnel, Noise, Displace, Gradient } from 'lamina'
import { TextureLoader } from 'three/src/loaders/TextureLoader'
import CloudMesh from "./octagon"
import TrigramMesh from './trigramMat';


export default function Model({ scroll, ...props }) {
  const group = useRef();
  const { nodes, materials, animations } = useGLTF('/DAO24.gltf');
  const { actions } = useAnimations(animations, group);

  const { active, progress, errors, item, loaded, total } = useProgress();

  const ref = useRef();

  console.log(actions);

  useEffect(() => {
    setTimeout(() => {
      actions['SCALE 1'].clampWhenFinished = true;
      actions['SCALE 1'].repetitions = 1;
      actions['SCALE 1'].play();

      actions['rotation-1'].play();

      actions['SCALE 2'].clampWhenFinished = true;
      actions['SCALE 2'].repetitions = 1;
      actions['SCALE 2'].play();
      actions['rotation-2'].play();

      actions['METABOLIC ROTATION'].play();

      actions['SOLID 4 ROTATION'].play();
      actions['DOTS 4 ROTATION'].play();
      actions['SOLID 4 SCALE'].play();

      actions['BLOCKS 1 ROTATION'].play();
      actions['BLOCKS 2 ROTATION'].play();

      actions['OCTAGON IN'].clampWhenFinished = true;
      actions['OCTAGON IN'].repetitions = 1;
      actions['OCTAGON IN'].play();
    }, 1700);
  }, [actions]);


  useEffect(
    () =>
      void (
        actions['CAMERA FLOW'].play().paused = true
      ),
    []
  );

  useFrame(() => {

    actions['CAMERA FLOW'].time = THREE.MathUtils.lerp(
      actions['CAMERA FLOW'].time,
      actions['CAMERA FLOW'].getClip().duration * scroll.current / 0.8,
      0.8
    );

    const scrollCurrent = scroll.current;
    const scrollSub = scrollCurrent.toFixed(1);

    if (scrollSub > '0.097') {
      actions['TRIGRAM SCALE'].clampWhenFinished = true;
      actions['TRIGRAM SCALE'].repetitions = 1;
      actions['TRIGRAM SCALE'].play();
      actions['TRIGRAM ROTATION'].play();
    }
  });


  const gradient = 0.6;
  const colorMap = useLoader(TextureLoader, 'texturedot.png');

  return (
    <group ref={group} {...props} dispose={null}>
      <group name="Scene">
        <group name="camera" position={[40, 0, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 4]}>
          <PerspectiveCamera name="camera_Orientation" makeDefault={true} far={100} near={0.1} fov={32.33} rotation={[-Math.PI / 2, 0, 0]} />
        </group>
        {/* <group name="layers">
          <ParticlesBackground />
        </group> */}

        <group name="OCTAGON_CONTROLLER" position={[0.5, -2, 0]}>
          <points name="1" geometry={nodes['1'].geometry} position={[0, 0, -56.72]}>
            <PointMaterial transparent color={'#fff'} size={0.6} sizeAttenuation={true} depthWrite={false} map={colorMap} />
          </points>
          <points name="2" geometry={nodes['2'].geometry} position={[0, 0, -60.03]}>
            <PointMaterial transparent color={'#fff'} size={0.6} sizeAttenuation={true} depthWrite={false} map={colorMap} />
          </points>
          <CloudMesh nodesName={nodes.OCTAGON} positionElem={[0, 0, -88.35]} positionElem2={[0, 0, -57.35]} />
        </group>

        <TrigramMesh nodesName={nodes.TRIGRAM} positionElem={[-9, -2, -160]} rotationElem={[0, 0, 0]} scaleElem={1} />

        <group name="METABOLIC" position={[15, -20, -260]} scale={0.94}>
          <mesh name="metabolic_blocks_1" layers={1} geometry={nodes.metabolic_blocks_1.geometry} material={nodes.metabolic_blocks_1.material}>
            <LayerMaterial ref={ref} toneMapped={false}>
              <Depth
                colorA="#ff0080"
                colorB="black"
                alpha={1}
                mode="normal"
                near={0.5 * gradient}
                far={0.5}
                origin={[0, 0, 0]}
              />
              <Fresnel
                mode="add"
                color="white"
                intensity={0.5}
                power={1.5}
                bias={0.05}
              />
            </LayerMaterial>
          </mesh>
          <points name="metabolic_points_1" layers={1} geometry={nodes.metabolic_points_1.geometry} position={[0, 27.31, 0]}>
            <PointMaterial
              transparent
              color={'#fff'}
              size={0.2}
              sizeAttenuation={true}
              depthWrite={false}
            />
          </points>
          <points name="metabolic_points_2" layers={1} geometry={nodes.metabolic_points_2.geometry}>
            <PointMaterial
              transparent
              color={'#fff'}
              size={0.2}
              sizeAttenuation={true}
              depthWrite={false}
            />
          </points>
          <mesh name="metabolic_blocks_2" layers={1} geometry={nodes.metabolic_blocks_2.geometry}>
            <LayerMaterial ref={ref} toneMapped={false}>
              <Depth
                colorA="#ff0080"
                colorB="black"
                alpha={1}
                mode="normal"
                near={0.5 * gradient}
                far={0.5}
                origin={[0, 0, 0]}
              />
              <Fresnel
                mode="add"
                color="white"
                intensity={0.5}
                power={1.5}
                bias={0.05}
              />

            </LayerMaterial>
          </mesh>
        </group>


        <group name="OBJECT_4" position={[120, -2, -285]}>
          <mesh name="sphere_solid" layers={1} geometry={nodes.sphere_solid.geometry} material={nodes.sphere_solid.material}>
            <LayerMaterial ref={ref}>
              <Depth
                colorA="#ff0080"
                colorB="black"
                alpha={1}
                mode="normal"
                near={0.5 * gradient}
                far={0.5}
                origin={[0, 0, 0]}
              />
              <Fresnel
                mode="add"
                color="white"
                intensity={0.5}
                power={1.5}
                bias={0.05}
              />
            </LayerMaterial>
          </mesh>
          <mesh name="blocks_1" layers={1} geometry={nodes.blocks_1.geometry} material={nodes.blocks_1.material} position={[0, -10.57, 0]} rotation={[-Math.PI, 0, -Math.PI]} scale={[-1.24, -1.12, -1.12]}>
            <LayerMaterial ref={ref} toneMapped={false}>
              <Depth
                colorA="#ff0080"
                colorB="black"
                alpha={1}
                mode="normal"
                near={0.5 * gradient}
                far={0.5}
                origin={[0, 0, 0]}
              />
              <Fresnel
                mode="add"
                color="white"
                intensity={0.5}
                power={1.5}
                bias={0.05}
              />
            </LayerMaterial>
          </mesh>
          <mesh name="blocks_2" layers={1} geometry={nodes.blocks_2.geometry} material={nodes.blocks_2.material} position={[0, 10.57, 0]} scale={[1.24, 1.12, 1.12]}>
            <LayerMaterial ref={ref} toneMapped={false}>
              <Depth
                colorA="#ff0080"
                colorB="black"
                alpha={1}
                mode="normal"
                near={0.5 * gradient}
                far={0.5}
                origin={[0, 0, 0]}
              />
              <Fresnel
                mode="add"
                color="white"
                intensity={0.5}
                power={1.5}
                bias={0.05}
              />
            </LayerMaterial>
          </mesh>
          <points name="sphere_dots" layers={1} geometry={nodes.sphere_dots.geometry} material={nodes.sphere_dots.material} scale={[0.92, 1, 0.97]}>
            <PointMaterial transparent size={0.3} depthWrite={false} />
          </points>
        </group>

      </group>
    </group >
  );
}



// useGLTF.preload('/DAO24.gltf')
