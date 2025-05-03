
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

export default function ProductListScreen() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    fetch('https://rh-technological-election-unity.trycloudflare.com/api/products')
      .then(res => res.json())
      .then(data => setProducts(data.products || []))
      .catch(err => console.log('Error:', err));
  }, []);

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.title}>{item.title}</Text>
      <Text>ID: {item.id}</Text>
    </View>
  );

  return (
    <FlatList
      data={products}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.container}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  card: { padding: 16, backgroundColor: '#f2f2f2', marginBottom: 10, borderRadius: 8 },
  title: { fontWeight: 'bold', fontSize: 16 }
});
